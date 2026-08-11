require('dotenv').config()
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const axios = require('axios');
const multer = require('multer');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
//   [ข้อ 6] จำกัดขนาดไฟล์สลิปกันคนอัปโหลดไฟล์ใหญ่มาก
// ==========================================
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB ต่อไฟล์
});

// Middleware Setup
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '/')));

// ==========================================
//   [ข้อ 5] Rate Limiting กัน brute-force / spam
// ==========================================
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 นาที
    max: 10,                  // 10 ครั้งต่อ IP ต่อหน้าต่างเวลา
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณาลองใหม่ภายหลัง' }
});

const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'สมัครสมาชิกบ่อยเกินไป กรุณาลองใหม่ภายหลัง' }
});

const slipLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 นาที
    max: 5,                   // ป้องกันคนยิงสลิปปลอมรัวๆ เพื่อสุ่มเดา
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'ส่งคำขอตรวจสอบสลิปบ่อยเกินไป กรุณาลองใหม่ภายหลัง' }
});

// ==========================================
//   [ข้อ 3] Helper: escape regex กัน injection
// ==========================================
function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ==========================================
//   [ข้อ 4] JWT Helpers
// ==========================================
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('❌ ไม่พบ JWT_SECRET ใน .env — กรุณาตั้งค่าก่อนรัน server (ใช้สตริงสุ่มยาวๆ)');
    process.exit(1);
}

function generateToken(user) {
    return jwt.sign(
        { userId: user.userId, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

// Middleware ตรวจ JWT สำหรับ route ที่ต้องยืนยันตัวตน
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // "Bearer TOKEN"

    if (!token) {
        return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่' });
        }
        req.user = decoded; // { userId, username, role }
        next();
    });
}

// ==========================================
//   [ข้อ 2] ตารางราคา — ต้องตรงกับปุ่มเลือกยอดในหน้าเว็บ (50/100/200/500)
//   แหล่งความจริงของราคาอยู่ฝั่ง server เท่านั้น ห้ามเชื่อราคาที่ client ส่งมาตรงๆ
// ==========================================
const PRICE_PACKAGES = {
    50: { role: 'user' },
    100: { role: 'user' },
    200: { role: 'vip' },
    500: { role: 'vip' }
};

// ==========================================
//          MONGODB CONNECTION & SCHEMAS
// ==========================================
mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI)
    .then(async () => {
        console.log('✅ Connected to MongoDB successfully');
        await initDefaultKeys();
    })
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// 1. Schema สำหรับคีย์สินค้า/สิทธิ์การใช้งาน
const licenseKeySchema = new mongoose.Schema({
    keyCode: { type: String, required: true, unique: true },
    role: { type: String, enum: ['admin', 'vip', 'user'], default: 'user' },
    status: { type: String, enum: ['unused', 'active', 'expired'], default: 'unused' },
    userId: { type: String, default: null },
    transRef: { type: String, default: null }
}, { timestamps: true });

// 2. Schema สำหรับข้อมูลผู้ใช้งาน (User)
const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    key: { type: String, required: true },
    role: { type: String, default: 'user' },
    lastLogin: { type: Date, default: null }
}, { timestamps: true });

// 3. Schema สำหรับป้องกันสลิปซ้ำ
const slipHistorySchema = new mongoose.Schema({
    transRef: { type: String, required: true, unique: true },
    amount: { type: Number, required: true },
    usedBy: { type: String, required: true }
}, { timestamps: true });

const LicenseKey = mongoose.model('LicenseKey', licenseKeySchema);
const User = mongoose.model('User', userSchema);
const SlipHistory = mongoose.model('SlipHistory', slipHistorySchema);

// ฟังก์ชันสร้าง Key เริ่มต้นให้อัตโนมัติถ้าฐานข้อมูลยังว่าง
async function initDefaultKeys() {
    try {
        const count = await LicenseKey.countDocuments();
        if (count === 0) {
            const defaultKeys = [
                { keyCode: "GAG2-VESPER-ADMIN-001", role: "admin", status: "unused" },
                { keyCode: "GAG2-VIP-MEMBER-999", role: "vip", status: "unused" },
                { keyCode: "GAG2-USER-KEY-0001", role: "user", status: "unused" },
                { keyCode: "FZZUSWLWBFNTQULIAYBDEVDPEPID", role: "user", status: "unused" }
            ];
            await LicenseKey.insertMany(defaultKeys);
            console.log('🎉 สร้าง Key เริ่มต้นลง MongoDB เรียบร้อยแล้ว!');
        }
    } catch (error) {
        console.error('Error initializing default keys:', error.message);
    }
}

// ==========================================
//              API ROUTES
// ==========================================

/**
 * 1. API: สมัครสมาชิกและผูก Key (Register)
 * POST /api/register
 * Body: { username, password, key }
 */
app.post('/api/register', registerLimiter, async (req, res) => {
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

        if (trimmedUser.length < 3) {
            return res.status(400).json({ success: false, message: 'Username ต้องมีความยาวอย่างน้อย 3 ตัวอักษร' });
        }
        if (password.length < 4) {
            return res.status(400).json({ success: false, message: 'Password ต้องมีความยาวอย่างน้อย 4 ตัวอักษร' });
        }

        // [ข้อ 3] Escape regex ก่อนใช้ค้นหา กัน Regex Injection / ReDoS
        const safeUserPattern = escapeRegex(trimmedUser);
        const existingUser = await User.findOne({ username: { $regex: new RegExp(`^${safeUserPattern}$`, 'i') } });
        if (existingUser) {
            return res.status(409).json({ success: false, message: 'ชื่อผู้ใช้งานนี้มีในระบบแล้ว' });
        }

        // ค้นหา Key ในระบบ MongoDB
        let keyRecord = await LicenseKey.findOne({ keyCode: trimmedKey });

        // [ระบบเสริมพิเศษ] ถ้ากรอก Key ยาวๆ มาแล้วยังไม่มีในระบบ ให้เพิ่มเข้า MongoDB อัตโนมัติ
        if (!keyRecord && trimmedKey.length > 15) {
            keyRecord = await LicenseKey.create({
                keyCode: trimmedKey,
                role: "user",
                status: "unused"
            });
        }

        if (!keyRecord) {
            return res.status(400).json({
                success: false,
                message: 'License Key นี้ไม่มีอยู่ในระบบ หรือไม่ถูกต้อง'
            });
        }

        if (keyRecord.status === 'active' || keyRecord.status === 'expired') {
            return res.status(409).json({
                success: false,
                message: 'License Key นี้ถูกลงทะเบียนเปิดใช้งานไปแล้ว'
            });
        }

        // Hash Password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const generatedUserId = 'usr_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5);

        // อัปเดตสถานะ Key
        keyRecord.status = 'active';
        keyRecord.userId = generatedUserId;
        await keyRecord.save();

        // บันทึก User ใหม่ลง MongoDB
        await User.create({
            userId: generatedUserId,
            username: trimmedUser,
            password: hashedPassword,
            key: trimmedKey,
            role: keyRecord.role || 'user'
        });

        return res.status(201).json({
            success: true,
            message: 'สมัครสมาชิกและผูก Key สำเร็จ!'
        });

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
 * [ข้อ 4] ตอบ JWT token กลับไปด้วย เพื่อให้ request ถัดไปยืนยันตัวตนได้จริง ไม่ใช่แค่เชื่อ username ที่ client ส่งมา
 */
app.post('/api/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'กรุณากรอก Username และ Password' });
        }

        const trimmedUser = username.trim();
        // [ข้อ 3] Escape regex ก่อนใช้ค้นหา
        const safeUserPattern = escapeRegex(trimmedUser);
        const user = await User.findOne({ username: { $regex: new RegExp(`^${safeUserPattern}$`, 'i') } });

        if (!user) {
            return res.status(401).json({ success: false, message: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' });
        }

        user.lastLogin = new Date();
        await user.save();

        const token = generateToken(user);

        return res.status(200).json({
            success: true,
            message: 'เข้าสู่ระบบสำเร็จ',
            token,
            user: {
                id: user.userId,
                username: user.username,
                key: user.key,
                role: user.role,
                createdAt: user.createdAt
            }
        });
    } catch (error) {
        console.error("Login Error:", error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * 3. API: ตรวจสอบสลิปอัตโนมัติผ่าน Thunder Solution และรับ Key (ซื้อคีย์อัตโนมัติ)
 * POST /api/verify-slip
 * Form-Data: { userId, amount, slip (file) }
 * [ข้อ 2] รองรับหลายราคาตาม PRICE_PACKAGES แทนราคาตายตัวเดียว
 * [ข้อ 5] จำกัดจำนวนครั้งด้วย slipLimiter
 * [ข้อ 6] จำกัดขนาดไฟล์ผ่าน multer limits ด้านบน
 */
app.post('/api/verify-slip', slipLimiter, upload.single('slip'), async (req, res) => {
    try {
        const { userId, amount } = req.body;
        const slipFile = req.file;

        if (!slipFile) {
            return res.status(400).json({ success: false, message: 'กรุณาแนบไฟล์สลิปโอนเงิน' });
        }

        if (!userId) {
            return res.status(400).json({ success: false, message: 'ไม่พบข้อมูลผู้ใช้งาน (User ID)' });
        }

        // [ข้อ 2] ตรวจสอบว่ายอดที่เลือกอยู่ในแพ็กเกจที่ร้านเปิดขายจริงหรือไม่
        // (ไม่เชื่อราคาที่ client ส่งมาตรงๆ แค่ใช้เลือกว่าเป็นแพ็กเกจไหน แล้วดึงเงื่อนไขจริงจาก PRICE_PACKAGES ฝั่ง server)
        const requestedAmount = parseFloat(amount);
        const packageInfo = PRICE_PACKAGES[requestedAmount];
        if (!packageInfo) {
            return res.status(400).json({ success: false, message: 'ยอดเงินที่เลือกไม่ตรงกับแพ็กเกจที่เปิดขาย' });
        }

        // ส่งไฟล์สลิปไปตรวจสอบที่ Thunder Solution API
        const formData = new FormData();
        const blob = new Blob([slipFile.buffer], { type: slipFile.mimetype });
        formData.append('file', blob, slipFile.originalname);

        const thunderRes = await axios.post('https://api.thunder.in.th/v1/verify-slip', formData, {
            headers: {
                'Authorization': `Bearer ${process.env.THUNDER_API_KEY}`,
                'Content-Type': 'multipart/form-data'
            }
        });

        const slipData = thunderRes.data;

        if (!slipData.success || !slipData.data) {
            return res.status(400).json({ success: false, message: 'สลิปไม่ถูกต้อง หรือไม่สามารถอ่านข้อมูลสลิปได้' });
        }

        const { transRef, amount: slipAmount, receiver } = slipData.data;

        // ตรวจสอบสลิปซ้ำ
        const isDuplicate = await SlipHistory.findOne({ transRef });
        if (isDuplicate) {
            return res.status(400).json({ success: false, message: 'สลิปใบนี้ถูกใช้งานไปแล้วในระบบ' });
        }

        // [ข้อ 2] ยอดเงินจริงในสลิป (ตรวจสอบจากธนาคารผ่าน Thunder) ต้องตรงกับแพ็กเกจที่เลือกไว้
        if (parseFloat(slipAmount) < requestedAmount) {
            return res.status(400).json({ success: false, message: `ยอดเงินในสลิปไม่ครบ (ต้องการ ${requestedAmount} บาทขึ้นไป)` });
        }

        // ตรวจสอบเลขบัญชีผู้รับ
        if (receiver.account !== process.env.MY_BANK_ACCOUNT) {
            return res.status(400).json({ success: false, message: 'สลิปนี้ไม่ได้โอนเข้าบัญชีร้านค้าที่ถูกต้อง' });
        }

        // ดึงคีย์ที่ยังไม่ถูกใช้งาน "ตาม role ของแพ็กเกจที่เลือก" ออกจาก MongoDB แบบ Atomic
        const assignedKey = await LicenseKey.findOneAndUpdate(
            { status: 'unused', role: packageInfo.role },
            { status: 'active', userId: userId, transRef: transRef },
            { new: true }
        );

        if (!assignedKey) {
            return res.status(500).json({ success: false, message: 'คีย์สินค้าหมดชั่วคราว กรุณาติดต่อแอดมิน' });
        }

        // บันทึกประวัติการใช้สลิป
        await SlipHistory.create({
            transRef,
            amount: slipAmount,
            usedBy: userId
        });

        return res.json({
            success: true,
            message: 'ชำระเงินและออกคีย์สำเร็จ!',
            licenseKey: assignedKey.keyCode
        });

    } catch (error) {
        console.error('Error verifying slip:', error?.response?.data || error.message);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการตรวจสอบสลิปกับระบบธนาคาร' });
    }
});

/**
 * 4. API: ตรวจสอบความถูกต้องของคีย์ (สำหรับเกมหรือระบบอื่นเรียกเช็ก)
 * POST /api/check-key
 * Body: { key }
 */
app.post('/api/check-key', async (req, res) => {
    try {
        const { key } = req.body;
        const keyRecord = await LicenseKey.findOne({ keyCode: key });

        if (!keyRecord) {
            return res.status(404).json({ valid: false, message: 'ไม่พบรหัสคีย์นี้ในระบบ' });
        }

        if (keyRecord.status !== 'active') {
            return res.status(400).json({ valid: false, message: 'คีย์นี้ยังไม่ถูกเปิดใช้งานหรือหมดอายุ' });
        }

        return res.json({ valid: true, message: 'คีย์ถูกต้อง พร้อมใช้งาน', keyInfo: keyRecord });
    } catch (error) {
        return res.status(500).json({ valid: false, message: 'เกิดข้อผิดพลาดในการตรวจสอบคีย์' });
    }
});

/**
 * 5. ตัวอย่าง Protected Route — ใช้ authenticateToken เป็นตัวอย่างสำหรับ endpoint ที่ต้องยืนยันตัวตนจริงในอนาคต
 * เช่น /api/trade/send (ตอนนี้หน้าเว็บยังจำลอง client-side อยู่ ยังไม่มี endpoint นี้จริง)
 */
app.get('/api/me', authenticateToken, async (req, res) => {
    const user = await User.findOne({ userId: req.user.userId }).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งาน' });
    return res.json({ success: true, user });
});

// [ข้อ 6] Error handler สำหรับ multer (เช่น ไฟล์ใหญ่เกินกำหนด)
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ success: false, message: 'ไฟล์สลิปมีขนาดใหญ่เกินไป (สูงสุด 5MB)' });
        }
        return res.status(400).json({ success: false, message: 'ไฟล์ที่แนบมาไม่ถูกต้อง' });
    }
    console.error(err);
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// เริ่มต้นเปิด Server
app.listen(PORT, () => {
    console.log(`===========================================`);
    console.log(`🚀 Server is running on port ${PORT}`);
    console.log(`🔗 Local URL: http://localhost:${PORT}`);
    console.log(`===========================================`);
});
