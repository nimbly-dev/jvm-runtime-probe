package com.nimbly.mcpjvmdebugger.agent;

import net.bytebuddy.asm.Advice;
import net.bytebuddy.implementation.bytecode.assign.Assigner;

public final class HitAdvice {
  private HitAdvice() {}

  @Advice.OnMethodExit(onThrowable = Throwable.class, suppress = Throwable.class)
  public static void onExit(
      @Advice.Origin("#t") String dottedClassName,
      @Advice.Origin("#m") String methodName,
      @Advice.AllArguments Object[] allArguments,
      @Advice.Return(typing = Assigner.Typing.DYNAMIC) Object returnValue,
      @Advice.Thrown Throwable thrown
  ) {
    ProbeRuntime.captureByClassMethod(dottedClassName, methodName, allArguments, returnValue, thrown);
  }
}
