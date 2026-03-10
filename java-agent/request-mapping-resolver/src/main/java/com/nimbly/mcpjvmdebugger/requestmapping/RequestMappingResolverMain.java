package com.nimbly.mcpjvmdebugger.requestmapping;

import com.fasterxml.jackson.databind.ObjectMapper;

public final class RequestMappingResolverMain {
    private RequestMappingResolverMain() {
    }

    public static void main(String[] args) throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        RequestMappingResolver.ResolverRequest request =
                mapper.readValue(System.in, RequestMappingResolver.ResolverRequest.class);
        RequestMappingResolver.ResolverResponse response =
                new RequestMappingResolver().resolve(request);
        mapper.writeValue(System.out, response);
    }
}
