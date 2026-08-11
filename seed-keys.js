require('dotenv').config();
const mongoose = require('mongoose');

// 1. กำหนด Format ของ LicenseKey Schema ให้ตรงกับใน server.js
const licenseKeySchema = new mongoose.Schema({
    keyCode: { type: String, required: true, unique: true },
    status: { type: String, enum: ['unused', 'active', 'expired'], default: 'unused' },
    userId: { type: String, default: null },
    transRef: { type: String, default: null }
}, { timestamps: true });

const LicenseKey = mongoose.model('LicenseKey', licenseKeySchema);

// 2. ฟังก์ชันสุ่มสร้างรหัสคีย์รูปแบบ (XXXX-XXXX-XXXX-XXXX)
function generateRandomKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const generateSegment = () => Array.from({ length: 4 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
    return `${generateSegment()}-${generateSegment()}-${generateSegment()}-${generateSegment()}`;
}

// 3. ฟังก์ชันหลักสำหรับรันสร้าง คีย์ ลง MongoDB
async function seedKeys(amount = 20) {
    try {
        console.log('🔄 กำลังเชื่อมต่อ MongoDB Atlas...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ เชื่อมต่อ MongoDB เรียบร้อยแล้ว!');

        const keysToInsert = [];
        const uniqueKeys = new Set();

        // สุ่มเจนคีย์ตามจำนวนที่กำหนด (ป้องกันรหัสซ้ำ)
        while (uniqueKeys.size < amount) {
            const newKey = generateRandomKey();
            if (!uniqueKeys.has(newKey)) {
                uniqueKeys.add(newKey);
                keysToInsert.push({
                    keyCode: newKey,
                    status: 'unused'
                });
            }
        }

        // บันทึกลง Database แบบ Batch Insert
        const result = await LicenseKey.insertMany(keysToInsert, { ordered: false });
        console.log(`🎉 สร้างคีย์สำเร็จจำนวน ${result.length} คีย์!`);
        console.log('--- ตัวอย่างคีย์ที่ถูกสร้าง ---');
        result.slice(0, 5).forEach((item, idx) => console.log(`${idx + 1}. ${item.keyCode}`));

    } catch (error) {
        if (error.code === 11000) {
            console.log('⚠️ มีบางคีย์ซ้ำกับที่มีอยู่ในระบบแล้ว ระบบข้ามคีย์ซ้ำให้อัตโนมัติ');
        } else {
            console.error('❌ เกิดข้อผิดพลาด:', error.message);
        }
    } finally {
        await mongoose.disconnect();
        console.log('🔌 ปิดการเชื่อมต่อ Database เรียบร้อย');
        process.exit(0);
    }
}

// สั่งรันสร้าง 20 คีย์ (เปลี่ยนตัวเลขได้ตามต้องการ)
seedKeys(20);