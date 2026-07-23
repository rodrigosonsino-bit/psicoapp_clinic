import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { Home, Users, Users2, Calendar, CalendarDays, Receipt, CreditCard, FileText, LogOut, Settings, Menu, X, Landmark, BookOpen } from 'lucide-react';
import { tokenStorage } from '../services/auth';
import { useState, useEffect } from 'react';
import './Layout.css';

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close sidebar on navigation (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Lock scrolling on document body when sidebar is open on mobile
  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [sidebarOpen]);

  const handleLogout = () => {
    tokenStorage.clearTokens();
    navigate('/auth');
  };

  const navItems = [
    { path: '/dashboard', icon: <Home size={20} />, label: 'Dashboard' },
    { path: '/patients', icon: <Users size={20} />, label: 'Pacientes' },
    { path: '/groups', icon: <Users2 size={20} />, label: 'Grupos Terapêuticos' },
    { path: '/appointments', icon: <Calendar size={20} />, label: 'Agendamentos' },
    { path: '/sessions', icon: <BookOpen size={20} />, label: 'Diário de Sessões' },
    { path: '/availability', icon: <CalendarDays size={20} />, label: 'Minha Disponibilidade' },
    { path: '/expenses', icon: <CreditCard size={20} />, label: 'Despesas' },
    { path: '/monthly-records', icon: <Calendar size={20} />, label: 'Faturamento Mensal' },
    { path: '/bank-reconciliation', icon: <Landmark size={20} />, label: 'Conciliação Bancária' },
    { path: '/receipts', icon: <Receipt size={20} />, label: 'Recibos' },
    { path: '/fiscal', icon: <FileText size={20} />, label: 'Relatórios Fiscais' },
    { path: '/profile', icon: <Settings size={20} />, label: 'Meu Perfil' },
  ];

  return (
    <div className="app-container animate-fade-in">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)}></div>
      )}

      <aside className={`sidebar ${sidebarOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <h2>PsicoApp</h2>
          <button 
            type="button" 
            className="sidebar-close-btn" 
            onClick={() => setSidebarOpen(false)}
            aria-label="Fechar menu"
          >
            <X size={20} />
          </button>
        </div>
        
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`nav-link ${location.pathname.startsWith(item.path) ? 'active' : ''}`}
              data-tooltip={item.label}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button 
            type="button" 
            className="nav-link logout-btn" 
            onClick={handleLogout}
            data-tooltip="Sair"
          >
            <LogOut size={20} />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      <div className="main-layout-wrapper">
        {/* Mobile Header Topbar */}
        <header className="mobile-header">
          <button 
            type="button" 
            className="hamburger-btn" 
            onClick={() => setSidebarOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu size={24} />
          </button>
          <span className="mobile-header-title">PsicoApp</span>
        </header>

        <main className="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
