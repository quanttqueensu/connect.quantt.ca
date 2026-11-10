import { redirect } from "next/navigation";

/** Alumni now sign in on /login with sponsors (one email box). Old links and invite emails land here. */
export default function AlumniLoginPage() {
  redirect("/login");
}
