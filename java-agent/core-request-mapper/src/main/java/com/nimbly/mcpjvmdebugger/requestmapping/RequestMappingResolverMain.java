package com.nimbly.mcpjvmdebugger.requestmapping;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbly.mcpjvmdebugger.requestmapping.api.ResolverRequest;
import com.nimbly.mcpjvmdebugger.requestmapping.api.ResolverResponse;

public final class RequestMappingResolverMain {
    private RequestMappingResolverMain() {
    }

    public static void main(String[] args) throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        ResolverRequest request = mapper.readValue(System.in, ResolverRequest.class);
        ResolverResponse response =
                new RequestMappingResolver().resolve(request);
        mapper.writeValue(System.out, response);
    }
}
