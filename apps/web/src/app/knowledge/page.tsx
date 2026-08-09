import { redirect } from "next/navigation";

/**
 * Knowledge belongs to an application, so it is a tab there now.
 *
 * This route used to render a second list of applications — the same two
 * columns as the catalog, reached from a different sidebar entry, so the same
 * screen had two entry paths and two mental models.
 */
export default function KnowledgeIndexPage() {
  redirect("/projects");
}
