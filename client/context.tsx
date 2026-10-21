import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { User } from '../shared/model';
import { api, json, setCsrf } from './api';
import { X, CheckCircle2, AlertCircle } from 'lucide-react';
interface Auth {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}
const AuthContext = createContext<Auth>(null!);
export const useAuth = () => useContext(AuthContext);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    api('/auth/me')
      .then((result) => {
        setUser(result.user);
        setCsrf(result.csrfToken);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);
  const login = async (username: string, password: string) => {
    const result = await api('/auth/login', { method: 'POST', body: json({ username, password }) });
    setUser(result.user);
    setCsrf(result.csrfToken);
    return result.user as User;
  };
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    setUser(null);
    setCsrf('');
  };
  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
  );
}
const ToastContext = createContext<(message: string, error?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  return (
    <ToastContext.Provider value={(message, error = false) => setToast({ message, error })}>
      {children}
      {toast && (
        <div
          className={`toast ${toast.error ? 'is-error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
          <span>{toast.message}</span>
          <button aria-label="关闭提示" className="icon-button" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
    </ToastContext.Provider>
  );
}
