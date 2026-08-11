require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// เชื่อมต่อ MongoDB Atlas
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- Mongoose Models ---
const keySchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    role: { type: String, default: 'user' },
    isUsed: { type: Boolean, default: false },
    assignedTo: { type: String, default: null }
});

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    key: { type: String, required: true },
    role: { type: String, default: 'user' },
    createdAt: { type: Date, default: Date.now },
    lastLogin: Date
});

const Key = mongoose.model('Key', keySchema);
const User = mongoose.model('User', userSchema);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- API ROUTES ---

// 1. Register API
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, key } = req.body;
        const trimmedUser = username?.trim();
        const trimmedKey = key?.trim();

        if (!trimmedUser || !password || !trimmedKey) {
            return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบ' });
        }

        // ตรวจสอบ User ซ้ำ
        const userExists = await User.findOne({ username: { $regex: new RegExp(`^${trimmedUser}$`, 'i') } });
        if (userExists) return res.status(409).json({ success: false, message: 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว' });

        // ค้นหา Key ใน MongoDB
        let keyDoc = await Key.findOne({ key: trimmedKey });

        // ถ้าระบบยังไม่มี Key นี้แต่มีความยาวพิเศษ ให้เพิ่มลง DB อัตโนมัติ
        if (!keyDoc && trimmedKey.length > 15) {
            keyDoc = await Key.create({ key: trimmedKey, role: 'user', isUsed: false });
        }

        if (!keyDoc) return res.status(400).json({ success: false, message: 'Key ไม่ถูกต้อง' });
        if (keyDoc.isUsed) return res.status(409).json({ success: false, message: 'Key ถูกใช้ไปแล้ว' });

        // Hash Password และบันทึก User
        const hashedPassword = await bcrypt.hash(password, 10);
        await User.create({ 
            username: trimmedUser, 
            password: hashedPassword, 
            key: trimmedKey, 
            role: keyDoc.role 
        });

        // อัปเดต Key
        keyDoc.isUsed = true;
        keyDoc.assignedTo = trimmedUser;
        await keyDoc.save();

        res.status(201).json({ success: true, message: 'สมัครสมาชิกสำเร็จ!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// 2. Login API
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username: { $regex: new RegExp(`^${username?.trim()}$`, 'i') } });
        
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ success: false, message: 'Username หรือ Password ไม่ถูกต้อง' });
        }

        user.lastLogin = new Date();
        await user.save();

        res.json({ success: true, user: { username: user.username, role: user.role } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
