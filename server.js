const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// เปิดใช้งาน Middleware
app.use(cors());
app.use(express.json());

// ให้บริการไฟล์ Static จากโฟลเดอร์ public (หน้าเว็บ)
app.use(express.static(path.join(__dirname, 'public')));

// ==================== DATABASE จำลอง (สามารถเปลี่ยนเป็น MongoDB หรือ PostgreSQL ได้ภายหลัง) ====================
let licenseKeys = {
    "VIP-KEY-12345": { status: "active", hwid: null, expires: "2026-12-31" }
};

// ==================== API ROUTES ====================

// 1. ตรวจสอบสถานะระบบ
app.get('/api/status', (req, res) => {
    res.json({ status: "online", message: "ChatphongHubx Enterprise System is running smoothly." });
});

// 2. ตรวจสอบและยืนยัน License Key (สำหรับ Roblox Script หรือ Client)[cite: 21]
app.post('/api/verify-key', (req, res) => {
    const { key, hwid } = req.body;

    if (!key) {
        return res.status(400).json({ success: false, message: "Missing license key." });
    }

    const licenseData = licenseKeys[key];

    if (!licenseData) {
        return res.status(404).json({ success: false, message: "Invalid license key." });
    }

    if (licenseData.status !== "active") {
        return res.status(403).json({ success: false, message: "License key is inactive or banned." });
    }

    // จัดการระบบ HWID Lock
    if (!licenseData.hwid) {
        licenseData.hwid = hwid || "UNKNOWN_HWID";
    } else if (licenseData.hwid !== hwid) {
        return res.status(401).json({ success: false, message: "HWID mismatch! Key is bound to another device." });
    }

    return res.json({ 
        success: true, 
        message: "License verified successfully.", 
        expires: licenseData.expires 
    });
});

// 3. สำหรับเพิ่ม Key ใหม่ (Admin)
app.post('/api/admin/create-key', (req, res) => {
    const { adminSecret, newKey, expiresDate } = req.body;
    
    // ตั้งรหัสผ่านผ่าน Environment Variable บน Render ได้
    const ADMIN_PASS = process.env.ADMIN_SECRET || "admin1234";

    if (adminSecret !== ADMIN_PASS) {
        return res.status(401).json({ success: false, message: "Unauthorized admin access." });
    }

    if (!newKey) {
        return res.status(400).json({ success: false, message: "Key name is required." });
    }

    licenseKeys[newKey] = {
        status: "active",
        hwid: null,
        expires: expiresDate || "2026-12-31"
    };

    res.json({ success: true, message: `Key ${newKey} created successfully.` });
});

// เปิดเซิร์ฟเวอร์
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
