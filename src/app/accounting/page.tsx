import { SiteNav } from "../components/SiteNav";
import { AccountingPanel } from "../components/AccountingPanel";

export default function AccountingPage() {
  return (
    <main className="flex flex-1 flex-col">
      <SiteNav />
      <AccountingPanel />
    </main>
  );
}
