import { VendorDetail } from "@/features/vendor-compliance/components/officer/vendor-detail";

export const dynamic = "force-dynamic";

export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const { uuid } = await params;
  return <VendorDetail vendorUuid={uuid} />;
}
