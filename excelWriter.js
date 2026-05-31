const fs = require('fs');
const path = require('path');

class ExcelWriter {
    static async writeToFile(phone, filename = 'output.csv') {
        if (!phone) return;
        const cleanPhone = phone.toString().trim();
        const filePath = path.resolve(filename);

        // ۱. اگر فایل وجود نداشت، ابتدا هدر جدول را می‌سازیم
        if (!fs.existsSync(filePath)) {
            // علامت \ufeff برای این است که اکسل شماره‌های فارسی/ایرانی و فونت را درست و بدون بهم‌ریختگی نشان دهد (BOM)
            fs.writeFileSync(filePath, '\ufeffphone numbers\n', 'utf8');
        }

        try {
            // ۲. شماره جدید را مستقیماً و بدون معطلی به انتهای فایل می‌چسبانیم
            fs.appendFileSync(filePath, `${cleanPhone}\n`, 'utf8');
            console.log(`💾 [CSV Written] ${cleanPhone} appended to ${filename}`);
        } catch (err) {
            console.error(`❌ Error writing to CSV: ${err.message}`);
        }
    }
}

module.exports = ExcelWriter;