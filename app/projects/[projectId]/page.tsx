import FamilyTreeApp from "@/components/FamilyTreeApp"

export default async function ProjectEditorPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  return <FamilyTreeApp projectId={projectId} />
}
