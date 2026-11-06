// Mount the existing client reader; the Node server owns API and persistence.
// 渲染之前先由历史步骤登记决定页面加载：过期条目的返回会直接跳出应用，此时不渲染、不加载数据。
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import Reader from './ui/Reader';
import {historySteps} from './ui/historySteps';
import './styles.css';
historySteps.boot(()=>createRoot(document.getElementById('root')!).render(<StrictMode><Reader/></StrictMode>));
