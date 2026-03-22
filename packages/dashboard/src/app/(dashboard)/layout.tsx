import { Sidebar } from '@/components/layout/Sidebar';
import { MobileNav } from '@/components/layout/MobileNav';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-950">
      <Sidebar />
      <MobileNav />
      <main className="md:ml-64">
        {/* pt-14 on mobile offsets the fixed top bar; md:pt-0 removes it on desktop */}
        <div className="mx-auto max-w-7xl px-4 py-8 pt-[calc(3.5rem+2rem)] sm:px-6 md:pt-8 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}
