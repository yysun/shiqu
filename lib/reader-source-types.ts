export type OriginalSource={title:string;text:string;url:string;kind:'passage'|'chapter';provider:string;retrievedAt:string};
export type SourceResult={source:OriginalSource|null;message:string;searchUrl:string};
