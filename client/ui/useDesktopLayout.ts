// 唯一的结构切换：至少 768×560 时使用桌面外壳，否则使用手机界面。
// 手机样式的媒体条件是它的精确补集 (max-width:767px), (max-height:559px)，CSS 与组件树始终一致。
// drawerForm：768–1023px 时侧栏以抽屉形式出现；只影响行为，不改变组件结构。
import {useMediaQuery} from './useMediaQuery';

export const desktopQuery='(min-width:768px) and (min-height:560px)';
export function useDesktopLayout(){return useMediaQuery(desktopQuery);}
export function useDrawerForm(){return useMediaQuery('(max-width:1023px)');}
