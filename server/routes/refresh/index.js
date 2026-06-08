/**
 * Refresh route - GET /refresh
 * Forces a reload of the Discord role membership cache, then redirects to
 * /access. Useful when a role was just assigned and hasn't been picked up by
 * the hourly background reload yet.
 */
export default function registerRefreshRoute(app, dependencies) {
  const { reloadAccessRoles } = dependencies;

  app.get("/refresh", async (req, res) => {
    try {
      await reloadAccessRoles();
    } catch (error) {
      console.error("Failed to reload access roles:", error.message);
    }
    res.redirect("/access");
  });
}
