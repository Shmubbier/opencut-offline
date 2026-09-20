import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	compiler: {
		removeConsole: process.env.NODE_ENV === "production",
	},
	reactStrictMode: true,
	productionBrowserSourceMaps: true,
	output: "standalone",
	typescript: { ignoreBuildErrors: true },
	eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
