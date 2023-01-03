import {
    IDerivation,
    endBatch,
    globalState,
    isSpyEnabled,
    spyReportEnd,
    spyReportStart,
    startBatch,
    untrackedEnd,
    untrackedStart,
    isFunction,
    allowStateReadsStart,
    allowStateReadsEnd,
    ACTION,
    EMPTY_ARRAY,
    die,
    getDescriptor,
} from '../internal';

// we don't use globalState for these in order to avoid possible issues with multiple
// mobx versions
let currentActionId = 0;
let nextActionId = 1;
const isFunctionNameConfigurable = getDescriptor(() => {}, 'name')?.configurable ?? false;

// we can safely recycle this object
const tmpNameDescriptor: PropertyDescriptor = {
    value: 'action',
    configurable: true,
    writable: false,
    enumerable: false,
};

export function createAction(
    actionName: string,
    fn: Function,
    autoAction: boolean = false,
    ref?: Object
): Function {
    if (window.__DEV__) {
        if (!isFunction(fn)) die('`action` can only be invoked on functions');
        if (typeof actionName !== 'string' || !actionName)
            die(`actions should have valid names, got: '${actionName}'`);
    }
    function res() {
        return executeAction(actionName, autoAction, fn, ref || this, arguments);
    }
    res.isMobxAction = true;
    if (isFunctionNameConfigurable) {
        tmpNameDescriptor.value = actionName;
        Object.defineProperty(res, 'name', tmpNameDescriptor);
    }
    return res;
}
// https://www.dazhuanlan.com/liu8800698/topics/1032049#Action-%E5%8E%9F%E7%90%86
export function executeAction(
    actionName: string,
    canRunAsDerivation: boolean,
    fn: Function,
    scope?: any,
    args?: IArguments
) {
    // mobx的观察者都被抽象成reaction，reaction的运行机制是进行schdule_  而runReactions里边的关键
    // 逻辑如下：
    //  if (globalState.inBatch > 0 || globalState.isRunningReactions) return
    //  下边这一句其实就是 globalState.inBatch++ 这样所有的待处理的reaction都会被积压，直到本事务执行完毕
    const runInfo = _startAction(actionName, canRunAsDerivation, scope, args);
    try {
        return fn.apply(scope, args);
    } catch (err) {
        runInfo.error_ = err;
        throw err;
    } finally {
        _endAction(runInfo);
    }
}

export interface IActionRunInfo {
    prevDerivation_: IDerivation | null;
    prevAllowStateChanges_: boolean;
    prevAllowStateReads_: boolean;
    notifySpy_: boolean;
    startTime_: number;
    error_?: any;
    parentActionId_: number;
    actionId_: number;
    runAsAction_?: boolean;
}

export function _startAction(
    actionName: string,
    canRunAsDeriviation: boolean, // true for autoAction
    scope: any,
    args?: IArguments
): IActionRunInfo {
    const notifySpy_ = window.__DEV__ && isSpyEnabled() && !!actionName;
    let startTime_: number = 0;
    // if (window.__DEV__ && notifySpy_) {
    //     startTime_ = Date.now();
    //     const flattendArgs = args ? Array.from(args) : EMPTY_ARRAY;
    //     spyReportStart({
    //         type: ACTION,
    //         name: actionName,
    //         object: scope,
    //         arguments: flattendArgs,
    //     });
    // }
    const prevDerivation_ = globalState.trackingDerivation;
    const runAsAction = !canRunAsDeriviation || !prevDerivation_;
    startBatch();
    let prevAllowStateChanges_ = globalState.allowStateChanges; // by default preserve previous allow
    if (runAsAction) {
        untrackedStart(); // TODO: 这里是trackingDerivation卸载了，为什么呢？？？？
        prevAllowStateChanges_ = allowStateChangesStart(true);
    }
    const prevAllowStateReads_ = allowStateReadsStart(true);
    const runInfo = {
        runAsAction_: runAsAction,
        prevDerivation_,
        prevAllowStateChanges_,
        prevAllowStateReads_,
        notifySpy_,
        startTime_,
        actionId_: nextActionId++,
        parentActionId_: currentActionId,
    };
    currentActionId = runInfo.actionId_;
    return runInfo;
}

export function _endAction(runInfo: IActionRunInfo) {
    if (currentActionId !== runInfo.actionId_) {
        die(30);
    }
    currentActionId = runInfo.parentActionId_;

    if (runInfo.error_ !== undefined) {
        globalState.suppressReactionErrors = true;
    }
    allowStateChangesEnd(runInfo.prevAllowStateChanges_);
    allowStateReadsEnd(runInfo.prevAllowStateReads_);
    endBatch();
    if (runInfo.runAsAction_) untrackedEnd(runInfo.prevDerivation_);
    if (window.__DEV__ && runInfo.notifySpy_) {
        spyReportEnd({ time: Date.now() - runInfo.startTime_ });
    }
    globalState.suppressReactionErrors = false;
}

export function allowStateChanges<T>(allowStateChanges: boolean, func: () => T): T {
    const prev = allowStateChangesStart(allowStateChanges);
    try {
        return func();
    } finally {
        allowStateChangesEnd(prev);
    }
}

export function allowStateChangesStart(allowStateChanges: boolean) {
    const prev = globalState.allowStateChanges;
    globalState.allowStateChanges = allowStateChanges;
    return prev;
}

export function allowStateChangesEnd(prev: boolean) {
    globalState.allowStateChanges = prev;
}
