import { SiteNav } from "../components/SiteNav";
import { InvoiceList } from "../components/InvoiceList";

export default function InvoicesPage() {
  return (
    <main className="flex flex-1 flex-col">
      <SiteNav />
      <InvoiceList />
    </main>
  );
}
