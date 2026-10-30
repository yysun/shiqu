// Real, small solid-color images generated with Pillow for provider boundary tests.
// Loading fixtures does not require Pillow or any image-generation service.
import {readFileSync} from 'node:fs';
export const imageBytes=name=>new Uint8Array(readFileSync(new URL('./images/'+name,import.meta.url)));
export const png=imageBytes('portrait.png');
export const jpeg=imageBytes('portrait.jpg');
export const encoded=Buffer.from(png).toString('base64');
