import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { AuthProvider } from './hooks/useAuth';
import { I18nProvider } from './i18n/I18nProvider';
import { ToastProvider } from './components/Toast';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err: any) => count < 1 && !(err?.status >= 400 && err?.status < 500),
      refetchOnWindowFocus: true,
      staleTime: 10_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ToastProvider>
          <BrowserRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
