import { useState, useEffect } from 'react';
import { Cpu } from 'lucide-react';
import Landing from '@/components/landing';
import Dashboard from '@/components/dashboard';

export default function Home() {
  const [userName, setUserName] = useState<string | null>(null);

  useEffect(() => {
    const storedName = localStorage.getItem('roblox_user_name');
    setUserName(storedName);
  }, []);

  if (userName) {
    return <Dashboard userName={userName} />;
  }

  return <Landing />;
}
