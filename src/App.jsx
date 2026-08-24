import React, { useEffect, useState } from 'react';
import UserApp from './user/UserApp.jsx';
import AdminApp from './admin/AdminApp.jsx';

function useHash() {
  const [h, setH] = useState(window.location.hash || '#/');
  useEffect(() => {
    const f = () => setH(window.location.hash || '#/');
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return h;
}

export default function App() {
  const h = useHash();
  return h.startsWith('#/admin') ? <AdminApp /> : <UserApp />;
}
