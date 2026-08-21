import { PolicyBuilder } from "@/features/vendor-compliance/components/platform/policy-builder";

export const dynamic = "force-dynamic";

export default async function CompanyPolicyPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const { uuid } = await params;
  return <PolicyBuilder uuid={uuid} />;
}
