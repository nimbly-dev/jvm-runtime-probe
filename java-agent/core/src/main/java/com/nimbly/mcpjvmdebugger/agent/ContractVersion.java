package com.nimbly.mcpjvmdebugger.agent;

import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;

final class ContractVersion {
  private static final String RESOURCE_PATH = "/mcp-contract.properties";
  private static final String FIELD = "contract.version";
  private static final String FALLBACK = "unknown";
  private static final String VALUE = resolve();

  private ContractVersion() {
  }

  static String value() {
    return VALUE;
  }

  private static String resolve() {
    try (InputStream in = ContractVersion.class.getResourceAsStream(RESOURCE_PATH)) {
      if (in != null) {
        Properties properties = new Properties();
        properties.load(in);
        String configured = properties.getProperty(FIELD);
        if (configured != null && !configured.isBlank()) return configured.trim();
      }
    } catch (IOException ignored) {
      // Fall through to environment/system fallback.
    }
    Package pkg = ContractVersion.class.getPackage();
    String implementationVersion = pkg == null ? null : pkg.getImplementationVersion();
    if (implementationVersion != null && !implementationVersion.isBlank()) {
      return implementationVersion.trim();
    }
    String envOverride = System.getenv("MCP_CONTRACT_VERSION");
    if (envOverride != null && !envOverride.isBlank()) return envOverride.trim();
    return FALLBACK;
  }
}
