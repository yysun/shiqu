INSERT INTO books (id,title,author,era,source_url,excerpt,note) VALUES ('liaozhai','聊斋志异','蒲松龄','清','https://www.shidianguji.com/book/XYXLZZY/chapter/1l6393j2mfdig','[historical third-party excerpt removed]','已录入《种梨》原文。其他篇目需提供可靠原文后再改编。') ON CONFLICT(id) DO NOTHING;
INSERT INTO books (id,title,author,era,source_url,excerpt,note) VALUES ('shishuo','世说新语','刘义庆 编','南朝宋','','','待录入选定篇目的原文与来源。') ON CONFLICT(id) DO NOTHING;
INSERT INTO books (id,title,author,era,source_url,excerpt,note) VALUES ('zhuangzi','庄子','庄周等','先秦','','','待录入选定篇目的原文与来源。') ON CONFLICT(id) DO NOTHING;
