// Persist source provenance and expose bounded retrieval diagnostics without provider response bodies.
export type OriginalSource={title:string;text:string;url:string;kind:'passage'|'chapter';provider:string;retrievedAt:string};
export type SourceFailure={code:'SOURCE_HTTP_ERROR'|'SOURCE_INVALID_RESPONSE'|'SOURCE_TIMEOUT'|'SOURCE_NETWORK_ERROR';status?:number};
export type SourceResult={source:OriginalSource|null;message:string;searchUrl:string;failure?:SourceFailure};
