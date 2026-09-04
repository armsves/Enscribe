import { SiteNav } from "../../components/SiteNav";
import { CreateInvoiceForm } from "../../components/CreateInvoiceForm";

export default function NewInvoicePage() {
  return (
    <main className="flex flex-1 flex-col">
      <SiteNav />
      <CreateInvoiceForm />
    </main>
  );
}
