import React, { useState } from 'react';
import { useObserver } from 'mobx-react-lite';
import { DatePicker } from 'antd';
import 'antd/dist/antd.css';

function About() {
    return (
        <div>
            <DatePicker />
        </div>
    );
}

export default useObserver(() => About());
