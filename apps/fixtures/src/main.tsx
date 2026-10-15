import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ShopApp } from './shop/ShopApp';
import { MailFixture } from './pages/mail';
import { VerificationFixture } from './pages/verification';
import './styles.css';

const path = window.location.pathname;
const App = path === '/mail' ? MailFixture : path === '/verification' ? VerificationFixture : ShopApp;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
