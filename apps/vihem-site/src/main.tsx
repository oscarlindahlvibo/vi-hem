import React from 'react';
import ReactDOM from 'react-dom/client';
import {SalesSite} from './SalesSite';
import './fonts.css';
import './style.css';
// Retire only a legacy worker on this marketing origin; app.vi-hem.se is separate.
if('serviceWorker' in navigator&&['vi-hem.se','www.vi-hem.se'].includes(location.hostname))void navigator.serviceWorker.getRegistrations().then(rs=>Promise.all(rs.filter(r=>new URL(r.scope).origin===location.origin).map(r=>r.unregister())));
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><SalesSite/></React.StrictMode>);
