// 导入3月2日番禺店数据
const importData = [
    {
        employeeName: "小莹",
        scheduleDate: "2026-03-02",
        startTime: "19:00",
        endTime: "20:00",
        projectName: "SSS",
        price: "260",
        notes: "文爷（300半价卷后），微信群",
        storeId: "panyu"
    },
    {
        employeeName: "小莹",
        scheduleDate: "2026-03-02",
        startTime: "20:00",
        endTime: "21:00",
        projectName: "SSS",
        price: "260",
        notes: "老九（458），微信群",
        storeId: "panyu"
    },
    {
        employeeName: "小莹",
        scheduleDate: "2026-03-02",
        startTime: "21:00",
        endTime: "22:00",
        projectName: "SSS",
        price: "260",
        notes: "牛角包（279），微信群",
        storeId: "panyu"
    },
    {
        employeeName: "小莹",
        scheduleDate: "2026-03-02",
        startTime: "23:00",
        endTime: "24:00",
        projectName: "SSS",
        price: "260",
        notes: "蛋蛋（558），微信群",
        storeId: "panyu"
    }
];

console.log("准备导入数据：", importData);

// 检查scheduleManager是否已初始化
if (typeof scheduleManager !== 'undefined') {
    console.log("scheduleManager已就绪，开始导入...");
    
    // 导入每条数据
    importData.forEach((data, index) => {
        console.log(`导入第${index + 1}条记录：`, data.employeeName, data.startTime + "-" + data.endTime);
        
        // 设置表单数据
        document.getElementById('employeeName').value = data.employeeName;
        document.getElementById('scheduleDate').value = data.scheduleDate;
        document.getElementById('startTime').value = data.startTime;
        document.getElementById('endTime').value = data.endTime;
        document.getElementById('projectName').value = data.projectName;
        document.getElementById('price').value = data.price;
        document.getElementById('notes').value = data.notes;
        
        // 触发添加按钮
        document.getElementById('addScheduleBtn').click();
        
        console.log(`✅ 第${index + 1}条记录导入完成`);
    });
    
    console.log("🎉 所有数据导入完成！");
    alert("✅ 成功导入4条排班记录！");
} else {
    console.error("scheduleManager未初始化");
    alert("请等待页面完全加载后再导入数据");
}
