import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@privy-io/react-auth", "@privy-io/wagmi"],
};

export default nextConfig;
