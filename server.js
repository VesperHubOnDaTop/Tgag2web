const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

// Middleware Setup
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// โครงสร้าง Database เริ่มต้น พร้อมรายการ Key พื้นฐาน
const initialDatabase = {
    keys: [
        { key: "GAG2-VESPER-ADMIN-001", role: "admin", isUsed: false, assignedTo: null },
        { key: "GAG2-VIP-MEMBER-999", role: "vip", isUsed: false, assignedTo: null },
        { key: "GAG2-USER-KEY-0001", role: "user", isUsed: false, assignedTo: null },
        { key: "FZZUSWLWBFNTQULIAYBDEVDPEPID", role: "user", isUsed: false, assignedTo: null },
    ],
    users: []
};

// ฟังก์ชันอ่านข้อมูลจาก database.json
function getDatabase() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            fs.writeFileSync(DB_FILE, JSON.stringify(initialDatabase, null, 4), 'utf8');
            return initialDatabase;
        }
        const fileData = fs.readFileSync(DB_FILE, 'utf8');
        const db = JSON.parse(fileData);
        
        if (!db.keys) db.keys = [];
        if (!db.users) db.users = [];
        return db;
    } catch (error) {
        console.error("Error reading database file:", error);
        return initialDatabase;
    }
}

// ฟังก์ชันบันทึกข้อมูลลง database.json
function saveDatabase(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 4), 'utf8');
        return true;
    } catch (error) {
        console.error("Error writing to database file:", error);
        return false;
    }
}

// ==========================================
//               API ROUTES
// ==========================================

/**
 * 1. API: สมัครสมาชิกและผูก Key (Register) - รองรับระบบ Key อัตโนมัติ
 * POST /api/register
 * Body: { username, password, key }
 */
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, key } = req.body;

        if (!username || !password || !key) {
            return res.status(400).json({
                success: false,
                message: 'กรุณากรอกข้อมูลให้ครบถ้วน (Username, Password, Key)'
            });
        }

        const trimmedUser = username.trim();
        const trimmedKey = key.trim();
        const db = getDatabase();

        // ตรวจสอบความยาว Username และ Password
        if (trimmedUser.length < 3) {
            return res.status(400).json({ success: false, message: 'Username ต้องมีความยาวอย่างน้อย 3 ตัวอักษร' });
        }
        if (password.length < 4) {
            return res.status(400).json({ success: false, message: 'Password ต้องมีความยาวอย่างน้อย 4 ตัวอักษร' });
        }

        // ตรวจสอบ Username ซ้ำ
        const userExists = db.users.some(u => u.username.toLowerCase() === trimmedUser.toLowerCase());
        if (userExists) {
            return res.status(409).json({ success: false, message: 'ชื่อผู้ใช้งานนี้มีในระบบแล้ว' });
        }

        // ค้นหา Key ในระบบ
        let keyConfigIndex = db.keys.findIndex(k => k.key === trimmedKey);

        // [ระบบเสริมพิเศษ] ถ้ากรอก Key ยาวๆ มา (เช่น Key ที่เจนจากเว็บภายนอก) แล้วยังไม่มีในระบบ ให้เพิ่มเข้า db.keys อัตโนมัติทันที
        if (keyConfigIndex === -1 && trimmedKey.length > 15) {
            db.keys.push({
                key: trimmedKey,
                role: "user",
                isUsed: false,
                assignedTo: null
            });
            keyConfigIndex = db.keys.length - 1;
        }

        // ถ้ายังหาไม่พบและไม่ใช่ Key ยาวพิเศษ ให้ตีว่าไม่ถูกต้อง
        if (keyConfigIndex === -1) {
            return res.status(400).json({
                success: false,
                message: 'License Key นี้ไม่มีอยู่ในระบบ หรือไม่ถูกต้อง'
            });
        }

        // ตรวจสอบว่า Key ถูกใช้งานไปแล้วหรือยัง
        if (db.keys[keyConfigIndex].isUsed) {
            return res.status(409).json({
                success: false,
                message: 'License Key นี้ถูกลงทะเบียนเปิดใช้งานไปแล้ว'
            });
        }

        // Hash Password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // อัปเดตสถานะ Key ให้เป็นถูกใช้งานแล้ว
        const keyRole = db.keys[keyConfigIndex].role || 'user';
        db.keys[keyConfigIndex].isUsed = true;
        db.keys[keyConfigIndex].assignedTo = trimmedUser;

        // สร้าง Object User ใหม่
        const newUser = {
            id: 'usr_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
            username: trimmedUser,
            password: hashedPassword,
            key: trimmedKey,
            role: keyRole,
            createdAt: new Date().toISOString(),
            lastLogin: null
        };

        db.users.push(newUser);
        
        if (saveDatabase(db)) {
            return res.status(201).json({
                success: true,
                message: 'สมัครสมาชิกและผูก Key สำเร็จ!'
            });
        } else {
            return res.status(500).json({
                success: false,
                message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล'
            });
        }

    } catch (error) {
        console.error("Register Error:", error);
        return res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์'
        });
    }
});

/**
 * 2. API: เข้าสู่ระบบ (Login)
 * POST /api/login
 */
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'กรุณากรอก Username และ Password' });
        }

        const trimmedUser = username.trim();
        const db = getDatabase();

        const userIndex = db.users.findIndex(u => u.username.toLowerCase() === trimmedUser.toLowerCase());
        if (userIndex === -1) {
            return res.status(401).json({ success: false, message: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' });
        }

        const user = db.users[userIndex];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' });
        }

        db.users[userIndex].lastLogin = new Date().toISOString();
        saveDatabase(db);

        return res.status(200).json({
            success: true,
            message: 'เข้าสู่ระบบสำเร็จ',
            user: {
                id: user.id,
                username: user.username,
                key: user.key,
                role: user.role,
                createdAt: user.createdAt
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// เริ่มต้นเปิด Server
app.listen(PORT, () => {
    console.log(`===========================================`);
    console.log(`🚀 Server is running on port ${PORT}`);
    console.log(`🔗 Local URL: http://localhost:${PORT}`);
    console.log(`===========================================`);
});
