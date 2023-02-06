import { global } from "./global";
import { ObservableObj } from "./store";

export class Reaction {
    f:() => void  = () => null
    observableObj: ObservableObj<number>[] = []
    dealObsers() {
        this.observableObj.forEach(obser => {
            obser.suitors.push(this)
        })
    }
}



export function autorun(fn: () => void) {
    //
    const reaction = new Reaction();
    reaction.f = fn
    global.trackingDerivation = reaction
    reaction.f()
    reaction.dealObsers()

}