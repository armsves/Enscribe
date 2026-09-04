import { SiteNav } from "./components/SiteNav";
import { HomeDashboard } from "./components/HomeDashboard";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <SiteNav />
      <HomeDashboard />
    </main>
  );
}
