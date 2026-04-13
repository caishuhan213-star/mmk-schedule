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
    }
