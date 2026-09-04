import { SiteNav } from "../../components/SiteNav";
import { PayPanel } from "../../components/PayPanel";

type Props = {
  params: Promise<{ ens: string }>;
};

export default async function PayPage({ params }: Props) {
  const { ens: raw } = await params;
  const ens = decodeURIComponent(raw).toLowerCase();

  return (
    <main className="flex flex-1 flex-col">
      <SiteNav />
      <PayPanel ens={ens} />
    </main>
  );
}
