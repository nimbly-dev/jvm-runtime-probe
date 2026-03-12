package com.nimbly.mcpjvmdebugger.requestmapping.ast;

import com.github.javaparser.ast.body.MethodDeclaration;

public record MethodContext(TypeDescriptor owner, MethodDeclaration method, TypeDescriptor originOwner) {
}

