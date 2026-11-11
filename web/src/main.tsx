import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { EquipmentPage } from './features/equipment/EquipmentPage';
import './index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="flex h-screen min-h-0 flex-col bg-ink-50">
          <EquipmentPage />
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
