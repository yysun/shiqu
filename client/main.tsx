// Mount the existing client reader; the Node server owns API and persistence.
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import Reader from './ui/Reader';
import './styles.css';
createRoot(document.getElementById('root')!).render(<StrictMode><Reader/></StrictMode>);
