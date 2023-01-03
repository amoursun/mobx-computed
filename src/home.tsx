import React, { Component } from 'react';
import { observer } from 'mobx-react';
import { store } from './store';

@observer
class Home extends Component {
    render() {
        return (
            <div>
                <div>
                    数量:
                    <span>{store.amount}</span>
                </div>
                <button onClick={() => store.add('amount')}>add</button>
                <button onClick={() => store.reduce('amount')}>reduce</button>
                <div>
                    价格:
                    <span>{store.price}</span>
                </div>
                <button onClick={() => store.add('price')}>add</button>
                <button onClick={() => store.reduce('price')}>reduce</button>
                <div>总花费: {store.total}</div>
            </div>
        );
    }
}

export default Home;
