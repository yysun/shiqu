-- Initialize book metadata only. New libraries contain no finished stories.
INSERT INTO books (id,title,author,era,source_url,excerpt,note) VALUES ('liaozhai','聊斋志异','蒲松龄','清','https://zh.wikisource.org/w/index.php?title=%E8%81%8A%E9%BD%8B%E5%BF%97%E7%95%B0%2F%E7%AC%AC01%E5%8D%B7&oldid=7908703#種梨','有鄉人貨梨於市，頗甘芳，價騰貴。有道士破巾絮衣，丐於車前，鄉人咄之而不去，鄉人怒，加​​以叱罵。道士曰：「一車數百顆，老衲止丐其一，於居士亦無大損，何怒為？」觀者勸置劣者一枚，令去，鄉人執不肯。

肆中傭保者，見喋聒不堪，遂出錢市一枚，付道士，道士拜謝，謂眾曰：「出家人不解吝惜，我有佳梨，請出供客。」或曰：「既有之，何不自食？」曰：「吾特需此核​​作種。」於是掬梨大啗，且盡，把核於手，解肩上鑱坎地上深數寸，納之，而覆以土，向市人索湯沃灌。好事者，於臨路店，索得沸瀋，道士接浸坎處。萬目攢視，見有勾萌出，漸大，俄成樹，枝葉扶疏，倏而花，倏而實，碩大芳馥，纍纍滿樹。道人乃即樹頭，摘賜觀者，頃刻而盡，已乃以鑱伐樹，丁丁良久乃斷，帶葉荷肩頭從容徐步而去。

初道士作法時，鄉人亦雜眾中，引領注目，竟忘其業。道士既去，始顧車中，則梨已空矣，方悟適所俵散，皆己物也。又細視車上一靶亡，是新鑿斷者，心大憤恨。急跡之，轉過牆隅，則斷靶棄垣下，始知所伐梨本，即是物也。道士不知所在，一市粲然。','已录入《种梨》原文。其他篇目需提供可靠原文后再改编。') ON CONFLICT(id) DO NOTHING;
INSERT INTO books (id,title,author,era,source_url,excerpt,note) VALUES ('shishuo','世说新语','刘义庆 编','南朝宋','','','待录入选定篇目的原文与来源。') ON CONFLICT(id) DO NOTHING;
INSERT INTO books (id,title,author,era,source_url,excerpt,note) VALUES ('zhuangzi','庄子','庄周等','先秦','','','待录入选定篇目的原文与来源。') ON CONFLICT(id) DO NOTHING;
