// Lint project syntax without coupling the standalone app to a hosting framework.
import js from '@eslint/js';
import parser from '@typescript-eslint/parser';
export default [
 {ignores:['dist/**','node_modules/**','desktop/dist/**','desktop/resources/**','src-tauri/target/**','src-tauri/gen/**','.data/**','data/**','.sites-runtime/**','.wrangler/**','outputs/**','work/**']},
 {files:['**/*.{js,mjs}'],rules:{...js.configs.recommended.rules,'no-undef':'off','no-unused-vars':'off','no-empty':['error',{allowEmptyCatch:true}]}},
 {files:['**/*.{ts,tsx,mts}'],languageOptions:{parser,parserOptions:{ecmaFeatures:{jsx:true}}},rules:{...js.configs.recommended.rules,'no-undef':'off','no-unused-vars':'off','no-empty':['error',{allowEmptyCatch:true}]}},
 // PDF filenames intentionally strip control characters.
 {files:['lib/reader-pdf.ts'],rules:{'no-control-regex':'off'}},
];
