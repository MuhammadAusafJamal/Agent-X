import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // @agentx/shared is a workspace package consumed through a symlink; listing it
  // here keeps Next's compilation of it identical to first-party source.
  transpilePackages: ["@agentx/shared"],
};

export default nextConfig;
