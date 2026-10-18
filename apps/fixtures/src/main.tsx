import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ShopApp } from './shop/ShopApp';
import { MailFixture } from './pages/mail';
import { VerificationFixture } from './pages/verification';
import { MailboxFixture } from './pages/mailbox';
import { JobDetailFixture, JobsFixture } from './pages/jobs';
import { SheetFixture } from './pages/sheet';
import { CanvasEditorFixture } from './pages/canvas-editor';
import { BlockerFixture, FlakyFixture, LongScrollFixture } from './pages/misc';
import { ApplyFixture } from './pages/apply';
import { CalendarFixture } from './pages/calendar';
import './styles.css';

const path = window.location.pathname;
const jobDetail = /^\/jobs\/(\d+)$/.exec(path);
const routes: Record<string, () => React.JSX.Element> = {
  '/mail': MailFixture,
  '/verification': VerificationFixture,
  '/mailbox': MailboxFixture,
  '/jobs': JobsFixture,
  '/sheet': SheetFixture,
  '/canvas-editor': CanvasEditorFixture,
  '/long-scroll': LongScrollFixture,
  '/flaky': FlakyFixture,
  '/blocker': BlockerFixture,
  '/apply': ApplyFixture,
  '/calendar': () => <CalendarFixture />,
};
const App = jobDetail ? () => <JobDetailFixture id={Number(jobDetail[1])} /> : (routes[path] ?? ShopApp);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
