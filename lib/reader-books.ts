// Share the selectable book directory across discovery and generation.
// All 24 catalog books have locally imported originals and verified citation support.
export type ReaderBook={id:string;title:string;author:string;era:string;genre:string;note:string};
export const readerBooks:ReaderBook[]=[
 {id:'liaozhai',title:'聊斋志异',author:'蒲松龄',era:'清',genre:'志怪',note:'借鬼狐，读人心'},
 {id:'zhuangzi',title:'庄子',author:'庄周等',era:'先秦',genre:'寓言',note:'换个角度看世界'},
 {id:'shishuo',title:'世说新语',author:'刘义庆 编',era:'南朝宋',genre:'人物',note:'魏晋人的小脾气'},
 {id:'西游记',title:'西游记',author:'吴承恩',era:'明',genre:'神魔',note:'取经路上，照见自己'},
 {id:'三国演义',title:'三国演义',author:'罗贯中',era:'明',genre:'历史',note:'局中人，局外心'},
 {id:'红楼梦',title:'红楼梦',author:'曹雪芹',era:'清',genre:'世情',note:'繁华深处，皆是人情'},
 {id:'水浒传',title:'水浒传',author:'施耐庵',era:'明',genre:'江湖',note:'江湖义气，人生进退'},
 {id:'儒林外史',title:'儒林外史',author:'吴敬梓',era:'清',genre:'讽刺',note:'功名背后，几分荒唐'},
 {id:'山海经',title:'山海经',author:'佚名',era:'先秦至汉',genre:'神话',note:'山海之间，万物有灵'},
 {id:'列子',title:'列子',author:'列御寇（旧题）',era:'古典',genre:'寓言',note:'寓言里的人生转弯'},
 {id:'搜神记',title:'搜神记',author:'干宝',era:'东晋',genre:'志怪',note:'奇事之中，藏着人心'},
 {id:'阅微草堂笔记',title:'阅微草堂笔记',author:'纪昀',era:'清',genre:'志怪',note:'怪谈背后，世故人情'},
 {id:'子不语',title:'子不语',author:'袁枚',era:'清',genre:'志怪',note:'奇闻异事，出人意料'},
 {id:'酉阳杂俎',title:'酉阳杂俎',author:'段成式',era:'唐',genre:'奇谈',note:'唐人的见闻与想象'},
 {id:'太平广记',title:'太平广记',author:'李昉等 编',era:'北宋',genre:'传奇',note:'历代奇闻，择篇细读'},
 {id:'博物志',title:'博物志',author:'张华',era:'西晋',genre:'奇谈',note:'天地万物，奇趣横生'},
 {id:'喻世明言',title:'喻世明言',author:'冯梦龙 编',era:'明',genre:'世情',note:'市井里的人情与转折'},
 {id:'警世通言',title:'警世通言',author:'冯梦龙 编',era:'明',genre:'世情',note:'一念之间，人生改道'},
 {id:'醒世恒言',title:'醒世恒言',author:'冯梦龙 编',era:'明',genre:'世情',note:'悲欢离合，世事无常'},
 {id:'初刻拍案惊奇',title:'初刻拍案惊奇',author:'凌濛初',era:'明',genre:'传奇',note:'偶然相逢，意外翻盘'},
 {id:'二刻拍案惊奇',title:'二刻拍案惊奇',author:'凌濛初',era:'明',genre:'传奇',note:'曲折之中，另有因由'},
 {id:'史记',title:'史记',author:'司马迁',era:'西汉',genre:'历史',note:'成败之间，看人的选择'},
 {id:'战国策',title:'战国策',author:'刘向 编订',era:'西汉编订',genre:'谋略',note:'言辞交锋，进退有术'},
 {id:'浮生六记',title:'浮生六记',author:'沈复',era:'清',genre:'生活',note:'寻常日子，也有深情'},
];
