import { redirect } from "next/navigation";

/**
 * Projects are a grouping, not a destination.
 *
 * This route rendered a list of the applications in one project — two clicks
 * deep for content that now sits under a heading on `/projects`.
 */
export default function ProjectPage() {
  redirect("/projects");
}
