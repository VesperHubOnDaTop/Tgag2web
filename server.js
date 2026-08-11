const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// เปิดใช้งาน Middleware
app.use(cors());
app.use(express.json());

// ให้บริการหน้าเว็บไซต์ Static จากโฟลเดอร์ public
app.use(express.static(path.join(__dirname, 'public')));

// ฐานข้อมูลจำลองสำหรับเก็บ License Key
let licenseKeys = {
    "VIP-KEY-12345": { status: "active", hwid: null, expires: "2026-12-31" }
};

// ==================== API ROUTES ====================

// ตรวจสอบสถานะระบบ
app.get('/api/status', (req, res) => {
    res.json({ status: "online", message: "ChatphongHubx Enterprise System is running smoothly." });
});

// ตรวจสอบ License Key และ HWID (สำหรับเชื่อมต่อกับสคริปต์เกม)[cite: 21]
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

// เพิ่ม Key ใหม่สำหรับ Admin
app.post('/api/admin/create-key', (req, res) => {
    const { adminSecret, newKey, expiresDate } = req.body;
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

// เริ่มต้นรันเซิร์ฟเวอร์
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
