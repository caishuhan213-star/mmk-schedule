const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'script.js');
let content = fs.readFileSync(filePath, 'utf8');

// 要插入的方法
const methodToInsert = `
    // 自动导入数据方法
    autoImportData(dataArray) {
        console.log('开始自动导入数据，共' + dataArray.length + '条记录');
        
        let importedCount = 0;
        const totalCount = dataArray.length;
        
        // 逐条导入
        const importNext = (index) => {
            if (index >= totalCount) {
                console.log('✅ 自动导入完成！共导入 ' + importedCount + ' 条记录');
                alert('✅ 数据导入完成！共导入 ' + importedCount + ' 条记录');
                return;
            }
            
            const data = dataArray[index];
            console.log('导入第 ' + (index + 1) + '/' + totalCount + ' 条：', data.employeeName, data.startTime + '-' + data.endTime);
            
            // 设置表单数据
            document.getElementById('employeeName').value = data.employeeName || '';
            document.getElementById('scheduleDate').value = data.scheduleDate || '';
            document.getElementById('startTime').value = data.startTime || '';
            document.getElementById('endTime').value = data.endTime || '';
            document.getElementById('projectName').value = data.projectName || '';
            document.getElementById('price').value = data.price || '';
            document.getElementById('notes').value = data.notes || '';
            
            // 延迟执行以确保表单更新
            setTimeout(() => {
                // 触发添加按钮
                const addBtn = document.getElementById('addScheduleBtn');
                if (addBtn) {
                    addBtn.click();
                    importedCount++;
                }
                
                // 导入下一条
                setTimeout(() => importNext(index + 1), 800);
            }, 500);
        };
        
        // 开始导入
        importNext(0);
    }`;

// 找到类结束的位置（第536行）
const lines = content.split('\n');
let classEndLine = -1;
let braceCount = 0;
let inClass = false;

for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('class ScheduleManager')) {
        inClass = true;
    }
    
    if (inClass) {
        // 统计大括号
        const openBraces = (lines[i].match(/{/g) || []).length;
        const closeBraces = (lines[i].match(/}/g) || []).length;
        braceCount += openBraces - closeBraces;
        
        if (braceCount === 0 && i > 0) {
            classEndLine = i;
            break;
        }
    }
}

if (classEndLine !== -1) {
    // 在类结束前插入方法
    lines.splice(classEndLine, 0, methodToInsert);
    content = lines.join('\n');
    fs.writeFileSync(filePath, content);
    console.log('方法插入成功');
} else {
    console.log('未找到类结束位置');
}
