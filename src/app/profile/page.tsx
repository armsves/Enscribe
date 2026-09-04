import { SiteNav } from "@/app/components/SiteNav";
import { ProfilePanel } from "@/app/components/ProfilePanel";

export default function ProfilePage() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteNav />
      <ProfilePanel />
    </div>
  );
}
